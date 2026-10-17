"""Stage 6b: deaths, wills and estates from the roster push, Profile will requests and the plugin queue."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from unittest import mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import src.api.characters_routes as routes
from src.auth import testing
from src.characters import wills
from src.characters.roster import replace_roster
from src.skins import db as db_mod

OWNER = "acc-owner"
OTHER = "acc-other"
PLUGIN = {"X-Plugin-Key": "pk"}
DIED_MS = 1_760_356_800_000  # 2025-10-13T12:00:00Z
DIED = datetime(2025, 10, 13, 12, tzinfo=timezone.utc)
API_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


@pytest.fixture
def db(tmp_path, monkeypatch, postgres):
    for name, sub in (
        ("DATA_DIR", ""),

        ("DRINKS_DIR", "drinks"),
        ("SKINS_DIR", "skins"),
        ("WARDROBE_DIR", "wardrobe"),
    ):
        monkeypatch.setattr(db_mod, name, tmp_path / sub if sub else tmp_path)
    monkeypatch.setenv("PLUGIN_KEY", "pk")
    db_mod.ensure_directories()
    wills._heir_rate.clear()
    return db_mod


def sessions(token: str) -> dict | None:
    return {
        "owner": {"scope": "profile", "player_uuid": OWNER, "realm_id": "main"},
        "other": {"scope": "profile", "player_uuid": OTHER, "realm_id": "main"},
        "owner-dev": {"scope": "profile", "player_uuid": OWNER, "realm_id": "dev"},
    }.get(token)


@pytest.fixture
def api(db):
    app = FastAPI()
    app.include_router(routes.characters_router)
    with mock.patch.object(routes, "get_session", side_effect=sessions):
        yield TestClient(app)


def bearer(token: str = "owner") -> dict:
    return {"Authorization": f"Bearer {token}"}


def char(cid: str, name: str, status: str = "ALIVE", **extra) -> dict:
    return {"id": cid, "name": name, "status": status, "race": "human", **extra}


def roster_row(cid: str, realm: str = "main") -> dict:
    rows = testing.rows("SELECT * FROM character_roster WHERE character_id = %s AND realm_id = %s", (cid, realm))
    return rows[0] if rows else {}


def estate_row(death_id: str, realm: str = "main") -> dict:
    rows = testing.rows("SELECT * FROM character_estates WHERE death_id = %s AND realm_id = %s", (death_id, realm))
    return rows[0] if rows else {}


def estate(status: str = "OPEN", revision: int = 0, **extra) -> dict:
    return {"status": status, "revision": revision, "due_at": DIED_MS + 86_400_000, **extra}


def seed_owner(realm: str = "main") -> None:
    replace_roster(
        OWNER,
        [
            char("c-ana", "Ana", will_revision=2, will_heir_id=None),
            char("c-dead", "Bram", "DEAD", died_at=DIED_MS, death_id="d-bram"),
            char("c-alt", "Kira Alt"),
        ],
        realm_id=realm,
    )
    replace_roster(OTHER, [char("c-kira", "Kira"), char("c-gone", "Kirsten", "DEAD")], realm_id=realm)


# --- roster push: deaths, wills, estates ---


def test_push_stores_death_fields_and_a_null_clears_them(db):
    replace_roster(OWNER, [char("c1", "Ana", "DEAD", died_at=DIED_MS, death_id="d-1")])
    row = roster_row("c1")
    assert (row["died_at"], row["death_id"]) == (DIED, "d-1")

    replace_roster(OWNER, [char("c1", "Ana", "ALIVE")])
    assert roster_row("c1")["death_id"] == "d-1"  # an old plugin's push leaves them

    replace_roster(OWNER, [char("c1", "Ana", "ALIVE", died_at=None, death_id=None)])
    row = roster_row("c1")
    assert (row["died_at"], row["death_id"]) == (None, None)


def test_will_revision_never_goes_back(db):
    replace_roster(OWNER, [char("c1", "Ana", will_heir_id="h-1", will_heir_name="Kira", will_revision=3)])
    assert roster_row("c1")["will_heir_name"] == "Kira"

    replace_roster(OWNER, [char("c1", "Ana", will_heir_id="h-old", will_heir_name="Old", will_revision=2)])
    row = roster_row("c1")
    assert (row["will_heir_id"], row["will_revision"]) == ("h-1", 3)

    replace_roster(OWNER, [char("c1", "Ana")])  # no will_revision: untouched
    assert roster_row("c1")["will_heir_id"] == "h-1"

    replace_roster(OWNER, [char("c1", "Ana", will_heir_id="h-1", will_heir_name="Kira Vale", will_revision=3)])
    assert roster_row("c1")["will_heir_name"] == "Kira Vale"  # equal revision replaces

    replace_roster(OWNER, [char("c1", "Ana", will_heir_id=None, will_heir_name="ignored", will_revision=4)])
    row = roster_row("c1")
    assert (row["will_heir_id"], row["will_heir_name"], row["will_revision"]) == (None, None, 4)


def test_estate_is_stored_by_realm_and_death_and_survives_the_character_leaving_the_push(db):
    replace_roster(
        OWNER,
        [char("c1", "Ana", "DEAD", died_at=DIED_MS, death_id="d-1", estate=estate())],
    )
    replace_roster(
        OWNER,
        [char("c1", "Ana", "DEAD", died_at=DIED_MS, death_id="d-1", estate=estate(revision=0, status="HELD"))],
        realm_id="dev",
    )
    assert estate_row("d-1")["status"] == "OPEN"
    assert estate_row("d-1", "dev")["status"] == "HELD"

    replace_roster(OWNER, [char("c2", "Cael")])  # c1 gone from the push
    assert roster_row("c1") == {}
    assert estate_row("d-1")["status"] == "OPEN"


def test_estate_revision_and_update_time_order(db):
    def push(**kw):
        replace_roster(OWNER, [char("c1", "Ana", "DEAD", death_id="d-1", estate=estate(**kw))])

    push(status="DECIDED", revision=1, updated_at=DIED_MS + 2000)
    push(status="OPEN", revision=0, updated_at=DIED_MS + 9000)  # older revision
    assert estate_row("d-1")["status"] == "DECIDED"

    push(status="OPEN", revision=1, updated_at=DIED_MS + 1000)  # same revision, older write
    assert estate_row("d-1")["status"] == "DECIDED"

    push(status="OPEN", revision=1)  # same revision, no time: cannot prove it is newer
    assert estate_row("d-1")["status"] == "DECIDED"

    push(status="REVERTED", revision=1, updated_at=DIED_MS + 3000)
    assert estate_row("d-1")["status"] == "REVERTED"

    push(status="DECIDED", revision=2)
    row = estate_row("d-1")
    assert (row["status"], row["revision"]) == ("DECIDED", 2)


def test_same_second_pushes_are_ordered_by_milliseconds(db):
    def push(status, updated_at):
        replace_roster(OWNER, [char("c1", "Ana", "DEAD", death_id="d-1", estate=estate(status, updated_at=updated_at))])

    push("DECIDED", DIED_MS + 800)
    push("OPEN", DIED_MS + 200)  # built earlier in the same second, delivered later
    assert estate_row("d-1")["status"] == "DECIDED"
    push("REVERTED", DIED_MS + 801)
    assert estate_row("d-1")["status"] == "REVERTED"


def test_negative_counts_and_money_read_as_zero(db):
    raw = estate("DECIDED", money_moved_cents=-5, participants={"thievery": {"outcome": "DONE", "counts": {"locks": -3}}})
    replace_roster(OWNER, [char("c1", "Ana", "DEAD", death_id="d-1", estate=raw)])
    payload = estate_row("d-1")["payload"]
    assert payload["money_moved_cents"] == 0
    assert payload["participants"]["thievery"]["counts"] == {"locks": 0}


def test_bad_estate_is_dropped_but_the_rest_of_the_push_applies(db):
    replace_roster(
        OWNER,
        [
            char("c1", "Ana", "DEAD", death_id="d-1", estate={"status": "WHATEVER", "revision": 0}),
            char("c2", "Bram", "DEAD", estate=estate()),  # no death id anywhere
            char("c3", "Cael", "DEAD", death_id="d-3", estate=estate(revision=-1)),
        ],
    )
    assert testing.value("SELECT COUNT(*) FROM character_estates") == 0
    assert roster_row("c1")["death_id"] == "d-1"


def test_estate_of_one_character_is_not_taken_over_by_another(db):
    replace_roster(OWNER, [char("c1", "Ana", "DEAD", death_id="d-1", estate=estate())])
    replace_roster(OTHER, [char("c9", "Mallory", "DEAD", death_id="d-1", estate=estate(revision=5))])
    row = estate_row("d-1")
    assert (row["character_id"], row["revision"]) == ("c1", 0)


def test_estate_payload_is_cleaned(db):
    raw = estate(
        status="DECIDED",
        decided_at=DIED_MS + 86_400_000,
        heir_name="Kira",
        recipients={
            "money": {"kind": "character", "name": "Kira"},
            "property": {"kind": "WAITING"},
            "guild_locks": {"kind": "bad kind!", "name": "x"},
            "unknown": {"kind": "GUILD", "name": "y"},
        },
        money_moved_cents=34025,
        participants={
            "denareconomy": {"outcome": "done", "revision": 0, "counts": {"accounts": 2, "bad": "x"}},
            "Bad Id!": {"outcome": "DONE"},
        },
    )
    replace_roster(OWNER, [char("c1", "Ana", "DEAD", death_id="d-1", estate=raw)])
    payload = estate_row("d-1")["payload"]
    assert payload["recipients"] == {
        "money": {"kind": "CHARACTER", "name": "Kira"},
        "property": {"kind": "WAITING", "name": None},
    }
    assert payload["participants"] == {"denareconomy": {"outcome": "DONE", "revision": 0, "counts": {"accounts": 2}}}
    assert payload["money_moved_cents"] == 34025
    assert payload["decided_at"] == "2025-10-14T12:00:00Z"


# --- Profile list ---


def test_list_shows_wills_requests_and_estates(api):
    seed_owner()
    replace_roster(
        OWNER,
        [
            char("c-ana", "Ana", will_heir_id="c-kira", will_heir_name="Kira", will_revision=3),
            char("c-dead", "Bram", "DEAD", died_at=DIED_MS, death_id="d-bram", estate=estate("DECIDED", heir_name="Kira")),
            char("c-alt", "Kira Alt", will_revision=0),
            char("c-lost", "Dara", "MISSING"),
        ],
    )
    api.post("/characters/c-alt/will", json={"heir_character_id": "c-kira", "base_revision": 0}, headers=bearer())

    chars = {c["id"]: c for c in api.get("/characters", headers=bearer()).json()["characters"]}
    assert chars["c-ana"]["will"] == {"heir_id": "c-kira", "heir_name": "Kira", "revision": 3}
    assert "will_request" not in chars["c-ana"]
    assert chars["c-alt"]["will_request"]["status"] == "pending"
    assert chars["c-alt"]["will_request"]["heir_name"] == "Kira"
    dead = chars["c-dead"]
    assert "will" not in dead
    assert dead["died_at"] == "2025-10-13T12:00:00Z"
    assert dead["estate"]["status"] == "DECIDED"
    assert dead["estate"]["heir_name"] == "Kira"
    assert chars["c-lost"]["estate"] is None


def test_list_shows_the_estate_of_the_current_death_only(api):
    replace_roster(OWNER, [char("c1", "Ana", "DEAD", death_id="d-1", estate=estate("CANCELLED"))])
    replace_roster(OWNER, [char("c1", "Ana", "DEAD", death_id="d-2")])  # died again, no estate yet
    chars = api.get("/characters", headers=bearer()).json()["characters"]
    assert chars[0]["estate"] is None


def test_refused_request_stays_on_the_card_for_a_week(api):
    seed_owner()
    req = api.post("/characters/c-ana/will", json={"heir_character_id": "c-kira", "base_revision": 2}, headers=bearer())
    rid = req.json()["request"]["id"]
    api.post("/characters/plugin/wills/applied", json={"realm_id": "main", "results": [{"id": rid, "result": "stale"}]}, headers=PLUGIN)
    ana = next(c for c in api.get("/characters", headers=bearer()).json()["characters"] if c["id"] == "c-ana")
    assert ana["will_request"]["result"] == "stale"
    assert API_TIME.fullmatch(ana["will_request"]["acked_at"])

    testing.execute("UPDATE will_requests SET acked_at = %s", (datetime.now(timezone.utc) - timedelta(days=8),))
    ana = next(c for c in api.get("/characters", headers=bearer()).json()["characters"] if c["id"] == "c-ana")
    assert "will_request" not in ana


# --- Profile will requests ---


def test_owner_names_an_heir_and_revokes(api):
    seed_owner()
    res = api.post("/characters/c-ana/will", json={"heir_character_id": "c-kira", "base_revision": 2}, headers=bearer())
    assert res.status_code == 200
    req = res.json()["request"]
    assert (req["heir_character_id"], req["heir_name"], req["status"], req["base_revision"]) == ("c-kira", "Kira", "pending", 2)
    assert API_TIME.fullmatch(req["created_at"]) and req["acked_at"] is None

    res = api.post("/characters/c-alt/will", json={"heir_character_id": None, "base_revision": 0}, headers=bearer())
    assert res.status_code == 200
    assert res.json()["request"]["heir_character_id"] is None


def test_own_alt_may_be_the_heir(api):
    seed_owner()
    res = api.post("/characters/c-ana/will", json={"heir_character_id": "c-alt", "base_revision": 2}, headers=bearer())
    assert res.status_code == 200


@pytest.mark.parametrize(
    ("token", "cid", "body", "status", "detail"),
    [
        ("other", "c-ana", {"heir_character_id": "c-kira", "base_revision": 2}, 403, None),
        ("owner-dev", "c-ana", {"heir_character_id": "c-kira", "base_revision": 2}, 403, None),
        ("owner", "c-dead", {"heir_character_id": "c-kira", "base_revision": 0}, 409, "character_not_alive"),
        ("owner", "c-ana", {"heir_character_id": "c-kira", "base_revision": 1}, 409, "will_changed"),
        ("owner", "c-ana", {"heir_character_id": "c-ana", "base_revision": 2}, 400, "invalid_heir"),
        ("owner", "c-ana", {"heir_character_id": "c-gone", "base_revision": 2}, 400, "invalid_heir"),
        ("owner", "c-ana", {"heir_character_id": "nobody", "base_revision": 2}, 400, "invalid_heir"),
        ("owner", "c-ana", {"heir_character_id": "c-kira", "base_revision": -1}, 400, None),
        ("owner", "c-ana", {"base_revision": 2}, 422, None),
    ],
)
def test_will_request_refusals(api, token, cid, body, status, detail):
    seed_owner()
    res = api.post(f"/characters/{cid}/will", json=body, headers=bearer(token))
    assert res.status_code == status
    if detail:
        assert res.json()["detail"] == detail
    assert testing.value("SELECT COUNT(*) FROM will_requests") == 0


def test_heir_in_another_realm_is_refused(api):
    seed_owner()
    replace_roster(OTHER, [char("c-devonly", "Devin")], realm_id="dev")
    res = api.post("/characters/c-ana/will", json={"heir_character_id": "c-devonly", "base_revision": 2}, headers=bearer())
    assert res.json()["detail"] == "invalid_heir"


def test_will_request_needs_a_profile_session(api):
    assert api.post("/characters/c-ana/will", json={"heir_character_id": None, "base_revision": 0}).status_code == 401


def test_one_pending_request_at_a_time_until_it_is_old(api):
    seed_owner()
    body = {"heir_character_id": "c-kira", "base_revision": 2}
    first = api.post("/characters/c-ana/will", json=body, headers=bearer()).json()["request"]["id"]
    res = api.post("/characters/c-ana/will", json=body, headers=bearer())
    assert (res.status_code, res.json()["detail"]) == (409, "request_pending")

    testing.execute("UPDATE will_requests SET created_at = %s", (datetime.now(timezone.utc) - timedelta(minutes=11),))
    second = api.post("/characters/c-ana/will", json=body, headers=bearer()).json()["request"]["id"]
    pending = api.get("/characters/plugin/wills/pending?realm_id=main", headers=PLUGIN).json()["requests"]
    assert [r["id"] for r in pending] == [second]

    res = api.post("/characters/plugin/wills/applied", json={"realm_id": "main", "results": [{"id": first, "result": "applied"}]}, headers=PLUGIN)
    assert res.json()["already"] == [first]


# --- plugin pull and ack ---


def test_pull_requires_a_realm_and_the_plugin_key(api):
    seed_owner()
    api.post("/characters/c-ana/will", json={"heir_character_id": "c-kira", "base_revision": 2}, headers=bearer())
    assert api.get("/characters/plugin/wills/pending", headers=PLUGIN).status_code == 400
    assert api.get("/characters/plugin/wills/pending?realm_id=", headers=PLUGIN).status_code == 400
    assert api.get("/characters/plugin/wills/pending?realm_id=main").status_code == 401
    assert api.get("/characters/plugin/wills/pending?realm_id=dev", headers=PLUGIN).json() == {"requests": []}

    (req,) = api.get("/characters/plugin/wills/pending?realm_id=main", headers=PLUGIN).json()["requests"]
    assert set(req) == {"id", "realm_id", "character_id", "account_uuid", "heir_character_id", "base_revision", "created_at"}
    assert API_TIME.fullmatch(req["created_at"])
    assert (req["realm_id"], req["character_id"], req["account_uuid"], req["heir_character_id"], req["base_revision"]) == (
        "main",
        "c-ana",
        OWNER,
        "c-kira",
        2,
    )


def test_dev_requests_stay_in_dev(api):
    seed_owner("dev")
    res = api.post("/characters/c-ana/will", json={"heir_character_id": "c-kira", "base_revision": 2}, headers=bearer("owner-dev"))
    rid = res.json()["request"]["id"]
    assert api.get("/characters/plugin/wills/pending?realm_id=main", headers=PLUGIN).json() == {"requests": []}

    res = api.post("/characters/plugin/wills/applied", json={"realm_id": "main", "results": [{"id": rid, "result": "applied"}]}, headers=PLUGIN)
    assert res.json()["refused"] == [{"id": rid, "reason": "realm"}]
    assert [r["id"] for r in api.get("/characters/plugin/wills/pending?realm_id=dev", headers=PLUGIN).json()["requests"]] == [rid]


def test_ack_requires_a_realm(api):
    assert api.post("/characters/plugin/wills/applied", json={"results": []}, headers=PLUGIN).status_code == 400
    assert api.post("/characters/plugin/wills/applied", json={"realm_id": "main", "results": []}).status_code == 401


def test_ack_records_results_and_a_replay_changes_nothing(api):
    seed_owner()
    rid = api.post("/characters/c-ana/will", json={"heir_character_id": "c-kira", "base_revision": 2}, headers=bearer()).json()["request"]["id"]
    body = {
        "realm_id": "main",
        "results": [
            {"id": rid, "result": "applied", "will_revision": 3, "heir_name": "Kira"},
            {"id": "nope", "result": "applied"},
        ],
    }
    res = api.post("/characters/plugin/wills/applied", json=body, headers=PLUGIN).json()
    assert res == {"ok": True, "acked": [rid], "already": [], "refused": [{"id": "nope", "reason": "unknown"}]}
    row = roster_row("c-ana")
    assert (row["will_heir_id"], row["will_heir_name"], row["will_revision"]) == ("c-kira", "Kira", 3)
    assert api.get("/characters/plugin/wills/pending?realm_id=main", headers=PLUGIN).json() == {"requests": []}

    body["results"] = [{"id": rid, "result": "stale"}]
    res = api.post("/characters/plugin/wills/applied", json=body, headers=PLUGIN).json()
    assert res["already"] == [rid]
    assert testing.value("SELECT result FROM will_requests WHERE id = %s", (rid,)) == "applied"


@pytest.mark.parametrize("result", ["stale", "invalid heir", "invalid", "character dead"])
def test_refusals_are_recorded_and_leave_the_will(api, result):
    seed_owner()
    rid = api.post("/characters/c-ana/will", json={"heir_character_id": "c-kira", "base_revision": 2}, headers=bearer()).json()["request"]["id"]
    res = api.post(
        "/characters/plugin/wills/applied",
        json={"realm_id": "main", "results": [{"id": rid, "result": result, "will_revision": 9}]},
        headers=PLUGIN,
    ).json()
    assert res["acked"] == [rid]
    assert roster_row("c-ana")["will_revision"] == 2


def test_unknown_result_is_refused(api):
    seed_owner()
    rid = api.post("/characters/c-ana/will", json={"heir_character_id": None, "base_revision": 2}, headers=bearer()).json()["request"]["id"]
    res = api.post("/characters/plugin/wills/applied", json={"realm_id": "main", "results": [{"id": rid, "result": "maybe"}]}, headers=PLUGIN)
    assert res.json()["refused"] == [{"id": rid, "reason": "result"}]
    assert len(api.get("/characters/plugin/wills/pending?realm_id=main", headers=PLUGIN).json()["requests"]) == 1


@pytest.mark.parametrize("revision", [999, 2, 4])
def test_applied_ack_updates_the_will_only_one_past_its_base(api, revision):
    seed_owner()
    rid = api.post("/characters/c-ana/will", json={"heir_character_id": "c-kira", "base_revision": 2}, headers=bearer()).json()["request"]["id"]
    res = api.post(
        "/characters/plugin/wills/applied",
        json={"realm_id": "main", "results": [{"id": rid, "result": "applied", "will_revision": revision}]},
        headers=PLUGIN,
    ).json()
    assert res["acked"] == [rid]
    row = roster_row("c-ana")
    assert (row["will_heir_id"], row["will_revision"]) == (None, 2)  # left for the roster push
    replace_roster(OWNER, [char("c-ana", "Ana", will_heir_id="c-kira", will_heir_name="Kira", will_revision=3)])
    assert roster_row("c-ana")["will_revision"] == 3


def test_applied_ack_never_rolls_a_newer_will_back(api):
    seed_owner()
    rid = api.post("/characters/c-ana/will", json={"heir_character_id": "c-kira", "base_revision": 2}, headers=bearer()).json()["request"]["id"]
    replace_roster(OWNER, [char("c-ana", "Ana", will_heir_id="c-alt", will_heir_name="Kira Alt", will_revision=5)])
    api.post(
        "/characters/plugin/wills/applied",
        json={"realm_id": "main", "results": [{"id": rid, "result": "applied", "will_revision": 3}]},
        headers=PLUGIN,
    )
    row = roster_row("c-ana")
    assert (row["will_heir_id"], row["will_revision"]) == ("c-alt", 5)


# --- heir search ---


def test_heir_search_finds_living_characters_in_the_realm(api):
    seed_owner()
    replace_roster("acc-third", [char("c-dev-kira", "Kira Dev")], realm_id="dev")
    res = api.get("/characters/heirs?q=kir&character_id=c-ana", headers=bearer())
    results = res.json()["results"]
    assert [(r["name"], r["own"]) for r in results] == [("Kira", False), ("Kira Alt", True)]
    for r in results:
        assert set(r) == {"id", "short_id", "name", "race", "own"}
        assert r["short_id"] == r["id"][:8]
    assert OWNER not in res.text and OTHER not in res.text


def test_heir_search_excludes_the_testator_and_uses_race_names(api):
    replace_roster(OWNER, [char("c-ana", "Anabel", race_name="High Elf"), char("c-ann", "Annabeth")])
    results = api.get("/characters/heirs?q=Ana&character_id=c-ana", headers=bearer()).json()["results"]
    assert results == []
    results = api.get("/characters/heirs?q=ana", headers=bearer()).json()["results"]
    assert [(r["name"], r["race"]) for r in results] == [("Anabel", "High Elf")]


def test_heir_search_limits(api):
    replace_roster(OTHER, [char(f"c-{i:02d}", f"Tomas {i:02d}") for i in range(14)] + [char("c-pct", "100% Tom")])
    assert api.get("/characters/heirs?q=to", headers=bearer()).status_code == 400
    assert len(api.get("/characters/heirs?q=tom", headers=bearer()).json()["results"]) == 10
    assert [r["name"] for r in api.get("/characters/heirs?q=0%25 t", headers=bearer()).json()["results"]] == ["100% Tom"]
    assert api.get("/characters/heirs?q=tom").status_code == 401


def test_heir_search_is_rate_limited(api):
    seed_owner()
    for _ in range(20):
        assert api.get("/characters/heirs?q=kir", headers=bearer()).status_code == 200
    assert api.get("/characters/heirs?q=kir", headers=bearer()).status_code == 429
    assert api.get("/characters/heirs?q=kir", headers=bearer("other")).status_code == 200


# --- wardrobe and kits refuse the dead ---


def test_wardrobe_and_kits_refuse_non_living_characters(db):
    from src.characters.lore_items import LoreItemError, list_character_kits, list_lore_items
    from src.characters.wardrobe import WardrobeError, clear_slot, get_wardrobe, set_active_slot

    replace_roster(OWNER, [char("c-ana", "Ana"), char("c-dead", "Bram", "DEAD"), char("c-lost", "Cael", "MISSING")])
    assert get_wardrobe(OWNER, "c-ana")["character_id"] == "c-ana"
    for cid in ("c-dead", "c-lost"):
        for call in (
            lambda: get_wardrobe(OWNER, cid),
            lambda: set_active_slot(OWNER, cid, None),
            lambda: clear_slot(OWNER, cid, "base"),
        ):
            with pytest.raises(WardrobeError) as err:
                call()
            assert err.value.status_code == 403
            assert str(err.value) == "Character is not alive"
        for call in (lambda: list_character_kits(OWNER, cid), lambda: list_lore_items(OWNER, cid)):
            with pytest.raises(LoreItemError) as err:
                call()
            assert str(err.value) == "Character is not alive"
